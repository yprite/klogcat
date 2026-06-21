use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
    pub validation_errors: Option<Vec<SettingsValidationError>>,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingsValidationError {
    pub field: String,
    pub message: String,
}
impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
            validation_errors: None,
        }
    }
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }
    pub fn with_validation_errors(mut self, errors: Vec<SettingsValidationError>) -> Self {
        self.validation_errors = Some(errors);
        self
    }
}
